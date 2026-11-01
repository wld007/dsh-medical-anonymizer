/**
 * Zip codec checks. Adversarial archives are built byte by byte here, without
 * the codec's writer, so that tests do not share its bugs. All data is invented.
 */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { readZip, extractZip, writeZip, packDirectory, isZipPath, crc32 } from '../lib/zip.js'

const tmp = join(dirname(fileURLToPath(import.meta.url)), '.tmp', 'zip')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

// ---------------------------------------------------------------------------
// Independent raw builder
// ---------------------------------------------------------------------------

/**
 * rawZip([{ name: string|Buffer, data, method?, flags?, crc?, size?, extra?, dir? }], { comment?, prefix? })
 * Overrides let a test lie about CRC or size.
 */
function rawZip(specs, { comment = Buffer.alloc(0), prefix = Buffer.alloc(0) } = {}) {
  const locals = []
  const centrals = []
  let offset = 0 // with a prefix this mimics an unadjusted self-extractor
  for (const s of specs) {
    const nameBytes = Buffer.isBuffer(s.name) ? s.name : Buffer.from(s.name, 'utf8')
    const data = s.data ?? Buffer.alloc(0)
    const method = s.method ?? 0
    const body = method === 8 ? deflateRawSync(data) : data
    const crc = s.crc ?? crc32(data)
    const size = s.size ?? data.length
    const extra = s.extra ?? Buffer.alloc(0)
    const flags = s.flags ?? 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(0x6000, 10) // 12:00:00
    lh.writeUInt16LE((44 << 9) | (3 << 5) | 15, 12) // 2024-03-15
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(size, 22)
    lh.writeUInt16LE(nameBytes.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt16LE(0x6000, 12)
    ch.writeUInt16LE((44 << 9) | (3 << 5) | 15, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(size, 24)
    ch.writeUInt16LE(nameBytes.length, 28)
    ch.writeUInt16LE(extra.length, 30)
    ch.writeUInt32LE(offset, 42)
    const local = Buffer.concat([lh, nameBytes, body])
    locals.push(local)
    centrals.push(Buffer.concat([ch, nameBytes, extra]))
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(specs.length, 8)
  end.writeUInt16LE(specs.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  return Buffer.concat([prefix, ...locals, cd, end, comment])
}

let counter = 0
async function save(buf) {
  const path = join(tmp, `case-${++counter}.zip`)
  await writeFile(path, buf)
  return path
}
const byName = (entries) => Object.fromEntries(entries.map((e) => [e.name, e]))

// ---------------------------------------------------------------------------

assert.ok(isZipPath('a/b/C.ZIP'))
assert.ok(isZipPath('x.zip'))
assert.ok(!isZipPath('x.zip.json'))
assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)

// Roundtrip with Chinese names: text deflates, random bytes stay stored.
{
  const text = Buffer.from('患者主诉：反复咳嗽三天。'.repeat(200))
  const noise = randomBytes(4096)
  const mtime = new Date(2024, 4, 6, 7, 8, 10)
  const path = join(tmp, 'roundtrip.zip')
  await writeZip(path, [
    { name: '示例医院/病历/记录.txt', data: text, mtime },
    { name: '示例医院/影像/噪声.bin', data: noise, mtime },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ])
  const raw = await readFile(path)
  assert.equal(raw.readUInt16LE(6) & 0x0800, 0x0800, 'UTF-8 flag is set')
  assert.equal(raw.readUInt16LE(8), 8, 'text is deflated')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.deepEqual((await readdir(tmp)).filter((f) => f.includes('.tmp-')), [], 'no temp file left')
  const { entries, warnings } = await readZip(path)
  assert.deepEqual(warnings, [])
  const m = byName(entries)
  assert.deepEqual(Object.keys(m), ['示例医院/病历/记录.txt', '示例医院/影像/噪声.bin', 'empty.txt'])
  assert.ok(m['示例医院/病历/记录.txt'].data.equals(text))
  assert.ok(m['示例医院/影像/噪声.bin'].data.equals(noise))
  assert.equal(m['empty.txt'].data.length, 0)
  assert.equal(m['示例医院/病历/记录.txt'].nameEncoding, 'utf8')
  assert.equal(m['示例医院/病历/记录.txt'].mtime.getTime(), mtime.getTime())
  // Second entry is stored: find its local header method.
  const second = raw.indexOf(Buffer.from('示例医院/影像/噪声.bin')) - 30
  assert.equal(raw.readUInt16LE(second + 8), 0, 'incompressible data is stored')
  // Unsafe or duplicate names are refused on write too.
  await assert.rejects(writeZip(join(tmp, 'bad.zip'), [{ name: '../x', data: Buffer.alloc(1) }]), /路径穿越/)
  await assert.rejects(writeZip(join(tmp, 'bad.zip'), [
    { name: 'a.txt', data: Buffer.alloc(1) }, { name: './a.txt', data: Buffer.alloc(1) },
  ]), /重复/)
  assert.ok(!existsSync(join(tmp, 'bad.zip')))
}

// GBK names without the UTF-8 flag (Windows-made zips), stored + deflated, with a dir entry.
{
  const gbk = (...bytes) => Buffer.from(bytes)
  const name1 = Buffer.concat([gbk(0xc4, 0xaa, 0xc4, 0xb3, 0xc4, 0xb3), Buffer.from('/'),
    gbk(0xbc, 0xc7, 0xc2, 0xbc), Buffer.from('.json')]) // 莫某某/记录.json
  const name2 = Buffer.concat([gbk(0xc4, 0xaa, 0xc4, 0xb3, 0xc4, 0xb3), Buffer.from('\\'),
    gbk(0xb2, 0xa1, 0xc0, 0xfa), Buffer.from('.txt')]) // 莫某某\病历.txt (backslash separator)
  assert.equal(new TextDecoder('gbk').decode(name1), '莫某某/记录.json', 'fixture bytes are right')
  const json = Buffer.from(JSON.stringify({ 姓名: '莫某某', 诊断: '示例' }))
  const path = await save(rawZip([
    { name: gbk(0xc4, 0xaa, 0xc4, 0xb3, 0xc4, 0xb3, 0x2f), dir: true },
    { name: name1, data: json, method: 8 },
    { name: name2, data: Buffer.from('plain'), method: 0 },
    { name: 'readme.txt', data: Buffer.from('ascii') },
  ]))
  const { entries } = await readZip(path)
  const m = byName(entries)
  assert.deepEqual(Object.keys(m), ['莫某某/', '莫某某/记录.json', '莫某某/病历.txt', 'readme.txt'])
  assert.equal(m['莫某某/'].isDirectory, true)
  assert.equal(m['莫某某/'].data, undefined)
  assert.equal(m['莫某某/记录.json'].nameEncoding, 'gbk')
  assert.ok(m['莫某某/记录.json'].data.equals(json))
  assert.equal(m['莫某某/病历.txt'].data.toString(), 'plain')
  assert.equal(m['readme.txt'].nameEncoding, 'ascii')
  assert.equal(m['readme.txt'].mtime.getTime(), new Date(2024, 2, 15, 12, 0, 0).getTime())
}

// Unflagged but valid UTF-8 names (macOS Archive Utility style) and the Info-ZIP Unicode Path extra.
{
  const utf8Name = Buffer.from('报告/结果.txt')
  const legacy = Buffer.from([0xb2, 0xa1, 0xc0, 0xfa, 0x2e, 0x74, 0x78, 0x74]) // 病历.txt in GBK
  const upath = Buffer.from('统一/病历.txt')
  const extra = Buffer.alloc(9 + upath.length)
  extra.writeUInt16LE(0x7075, 0)
  extra.writeUInt16LE(5 + upath.length, 2)
  extra[4] = 1
  extra.writeUInt32LE(crc32(legacy), 5)
  upath.copy(extra, 9)
  const { entries } = await readZip(await save(rawZip([
    { name: utf8Name, data: Buffer.from('a') },
    { name: legacy, data: Buffer.from('b'), extra },
  ])))
  assert.deepEqual(entries.map((e) => [e.name, e.nameEncoding]), [['报告/结果.txt', 'utf8'], ['统一/病历.txt', 'utf8']])
}

// Zip-slip and malformed names are rejected.
for (const evil of ['../x', '/abs', 'a/../../b', 'C:\\x', 'c:x', '..\\x', 'a\0b', '\\\\server\\share\\x']) {
  const path = await save(rawZip([{ name: 'ok.txt', data: Buffer.from('1') }, { name: evil, data: Buffer.from('x') }]))
  await assert.rejects(readZip(path), /路径穿越|非法字符/, `rejects ${JSON.stringify(evil)}`)
  await assert.rejects(extractZip(path, join(tmp, 'slip-out')), /路径穿越|非法字符/)
}
assert.ok(!existsSync(join(tmp, 'x')))

// Harmless prefixes are normalized; macOS junk is skipped silently.
{
  const { entries } = await readZip(await save(rawZip([
    { name: './a//b/./c.txt', data: Buffer.from('c') },
    { name: '__MACOSX/', data: Buffer.alloc(0) },
    { name: '__MACOSX/a/b/._c.txt', data: Buffer.from('junk') },
    { name: 'a/.DS_Store', data: Buffer.from('junk') },
    { name: '.DS_Store', data: Buffer.from('junk') },
  ])))
  assert.deepEqual(entries.map((e) => e.name), ['a/b/c.txt'])
}

// Duplicates after normalization, and file/dir conflicts.
await assert.rejects(readZip(await save(rawZip([
  { name: 'a/b.txt', data: Buffer.from('1') }, { name: 'a\\b.txt', data: Buffer.from('2') },
]))), /重复/)
await assert.rejects(readZip(await save(rawZip([
  { name: 'a', data: Buffer.from('1') }, { name: 'a/b.txt', data: Buffer.from('2') },
]))), /冲突/)

// Unsupported methods and encryption.
await assert.rejects(readZip(await save(rawZip([{ name: 'x.bin', data: Buffer.from('x'), method: 12 }]))), /不支持的压缩方式/)
await assert.rejects(readZip(await save(rawZip([{ name: 'x.bin', data: Buffer.from('x'), flags: 1 }]))), /已加密/)

// CRC mismatch, stored and deflated.
await assert.rejects(readZip(await save(rawZip([{ name: 'x.txt', data: Buffer.from('hello'), crc: 1234 }]))), /CRC/)
await assert.rejects(readZip(await save(rawZip([{ name: 'x.txt', data: Buffer.from('hello'.repeat(50)), method: 8, crc: 99 }]))), /CRC/)

// Bombs.
{
  const zeros = Buffer.alloc(20 * 1024 * 1024)
  const honest = await save(rawZip([{ name: 'zeros.bin', data: zeros, method: 8 }]))
  await assert.rejects(readZip(honest), /压缩比|zip 炸弹/, 'ratio limit')
  await assert.rejects(readZip(honest, { maxRatio: 1e9, maxTotalBytes: 1024 * 1024 }), /zip 炸弹/, 'total limit')
  await assert.rejects(readZip(honest, { maxRatio: 1e9, maxEntryBytes: 1024 * 1024 }), /单文件上限/, 'entry limit')
  // Header lies: declares 100 bytes, inflates to 20 MiB. The inflater cap stops it.
  const liar = await save(rawZip([{ name: 'zeros.bin', data: zeros, method: 8, size: 100 }]))
  await assert.rejects(readZip(liar), /zip 炸弹/, 'maxOutputLength cap')
  // Too many entries.
  const many = await save(rawZip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') }))))
  await assert.rejects(readZip(many, { maxEntries: 10 }), /条目数/)
  assert.equal((await readZip(many)).entries.length, 30)
  // Within explicit limits it is accepted.
  const ok = await readZip(honest, { maxRatio: 1e9 })
  assert.equal(ok.entries[0].data.length, zeros.length)
}

// Comments, prepended data and garbage.
{
  const body = [{ name: 'a.txt', data: Buffer.from('hello') }]
  const withComment = await readZip(await save(rawZip(body, { comment: Buffer.from('PK\x05\x06 fake inside comment') })))
  assert.equal(withComment.entries[0].data.toString(), 'hello')
  const prefixed = await readZip(await save(rawZip(body, { prefix: Buffer.from('#!/bin/sh stub\n') })))
  assert.equal(prefixed.entries[0].data.toString(), 'hello')
  assert.equal(prefixed.warnings.length, 1)
  await assert.rejects(readZip(await save(Buffer.from('not a zip at all, definitely not'))), /不是 zip/)
  const truncated = rawZip([{ name: 'a.txt', data: randomBytes(1000) }])
  await assert.rejects(readZip(await save(truncated.subarray(200))), /zip/)
}

// packDirectory → extractZip roundtrip.
{
  const src = join(tmp, 'src')
  const files = {
    '张三/记录.json': Buffer.from('{"a":1}'),
    '张三/影像/CT001.dcm': randomBytes(70000),
    'z.txt': Buffer.from('zzz'),
    'a/b/c/深层.txt': Buffer.from('深'.repeat(1000)),
  }
  for (const [rel, data] of Object.entries(files)) {
    await mkdir(dirname(join(src, rel)), { recursive: true })
    await writeFile(join(src, rel), data)
  }
  const zipPath = join(tmp, 'packed.zip')
  assert.equal(await packDirectory(src, zipPath), 4)
  const { entries } = await readZip(zipPath)
  assert.deepEqual(entries.map((e) => e.name), Object.keys(files).sort())
  const out = join(tmp, 'out')
  const result = await extractZip(zipPath, out)
  assert.deepEqual(result.files, Object.keys(files).sort())
  for (const [rel, data] of Object.entries(files)) {
    const target = join(out, rel)
    assert.ok((await readFile(target)).equals(data), rel)
    assert.equal((await stat(target)).mode & 0o777, 0o600)
  }
  // Extracting again over existing files refuses to overwrite.
  await assert.rejects(extractZip(zipPath, out), /EEXIST/)
}

// ZIP64: more than 65535 entries.
{
  const zipPath = join(tmp, 'many.zip')
  const count = 65600
  await writeZip(zipPath, Array.from({ length: count }, (_, i) => ({ name: `d${i % 50}/f${i}.txt`, data: Buffer.from(String(i)) })))
  const raw = await readFile(zipPath)
  assert.ok(raw.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'ZIP64 EOCD present')
  await assert.rejects(readZip(zipPath), /条目数/)
  const { entries } = await readZip(zipPath, { maxEntries: 70000 })
  assert.equal(entries.length, count)
  assert.equal(entries[count - 1].name, `d${(count - 1) % 50}/f${count - 1}.txt`)
  assert.equal(entries[count - 1].data.toString(), String(count - 1))
  if (existsSync('/usr/bin/unzip')) {
    execFileSync('/usr/bin/unzip', ['-tqq', zipPath], { stdio: 'pipe' })
  }
}

// Cross-check with the system zip/unzip tools when present.
if (existsSync('/usr/bin/zip') && existsSync('/usr/bin/unzip')) {
  const src = join(tmp, 'sys-src')
  await mkdir(join(src, 'sub'), { recursive: true })
  await writeFile(join(src, 'sub', 'notes.txt'), 'note '.repeat(500))
  await writeFile(join(src, 'blob.bin'), randomBytes(5000))
  const sysZip = join(tmp, 'system.zip')
  execFileSync('/usr/bin/zip', ['-qrX', sysZip, '.'], { cwd: src })
  const { entries } = await readZip(sysZip)
  const m = byName(entries)
  assert.equal(m['sub/'].isDirectory, true)
  assert.equal(m['sub/notes.txt'].data.toString(), 'note '.repeat(500))
  assert.equal(m['blob.bin'].data.length, 5000)
  // And the system unzip accepts our output, Chinese names included.
  const ours = join(tmp, 'roundtrip.zip')
  execFileSync('/usr/bin/unzip', ['-tqq', ours], { stdio: 'pipe' })
} else {
  console.log('(skip) /usr/bin/zip not found')
}

await rm(tmp, { recursive: true, force: true })
console.log('ZIP PASS')
