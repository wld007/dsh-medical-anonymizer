/**
 * One DICOM file through header de-identification.
 *
 * read header → apply profile → verify the new header in memory → write
 * header + byte-identical pixel data + tail → re-read and compare the pixel
 * hash. Pixel data is streamed, never held in memory or decoded.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  readDicom, parseDicomBuffer, encodeHeader, encodeElements, decodeAscii, charsetDecoder,
} from './codec.js'
import { deidentify, verifyHeader, dictVr } from './profile.js'

export { sniffDicom } from './codec.js'
export { dicomPolicy, patientCode, remapUid } from './profile.js'

const DICOMDIR_CLASS = '1.2.840.10008.1.3.10'

const TS_NAMES = {
  '1.2.840.10008.1.2': '隐式 VR 小端',
  '1.2.840.10008.1.2.1': '显式 VR 小端',
  '1.2.840.10008.1.2.4.50': 'JPEG 基线',
  '1.2.840.10008.1.2.4.57': 'JPEG 无损',
  '1.2.840.10008.1.2.4.70': 'JPEG 无损 SV1',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS 无损',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS 近无损',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 无损',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.5': 'RLE 无损',
}

/**
 * @param {object} context
 * @param {string} context.path absolute input path
 * @param {string} context.relPath path relative to the input root ("/"-separated)
 * @param {string} context.outputDir run output directory
 * @param {string} [context.outputRelPath] output path relative to outputDir (defaults to relPath)
 * @param {{ check(target: string): Promise<string> }} [context.guard] write guard
 * @param {string} context.salt vault salt (UID remapping)
 * @param {Buffer} context.runKey per-run secret (patient codes), never stored
 * @param {number} context.shiftDays
 * @param {object} context.policy resolved policy
 */
export async function processDicomFile(context) {
  const { path, relPath, outputDir, guard } = context
  const outputRelPath = context.outputRelPath ?? relPath
  const started = Date.now()
  const file = {
    relPath,
    kind: 'dicom',
    bytes: 0,
    status: 'running',
    rounds: 1,
    durationMs: 0,
    entities: [],
    issues: [],
    structure: { ok: true, checks: [] },
    modelCalls: 0,
    dicom: null,
  }
  const finish = (status) => {
    file.status = status
    file.durationMs = Date.now() - started
    return file
  }

  let parsed
  try {
    file.bytes = (await stat(path)).size
    parsed = await readDicom(path, { dict: dictVr })
  } catch (error) {
    file.issues.push({ severity: 'error', code: 'load', detail: `无法解析 DICOM：${String(error?.message ?? error)}` })
    return finish('failed')
  }

  const sopClass = decodeAscii(parsed.meta.find((el) => el.tag === '00020002')?.value)
  if (sopClass === DICOMDIR_CLASS || /(^|\/)DICOMDIR$/i.test(relPath)) {
    file.issues.push({
      severity: 'warn',
      code: 'dicomdir',
      detail: 'DICOMDIR 含病人姓名等索引信息且内部按字节偏移互相引用，未输出；如需要请用阅片软件对输出目录重新生成',
    })
    return finish('skipped')
  }

  let result
  let header
  let tail
  try {
    result = deidentify(parsed, context)
    header = encodeHeader({ meta: result.meta, dataset: result.dataset, explicit: parsed.explicit })
    tail = encodeElements(result.tail, parsed.explicit)
  } catch (error) {
    file.issues.push({ severity: 'error', code: 'dicom', detail: `元数据处理失败：${String(error?.message ?? error)}` })
    return finish('failed')
  }
  file.issues.push(...result.issues)
  if (parsed.vrMismatch) {
    file.issues.push({ severity: 'warn', code: 'dicom-vr', detail: '文件声明的传输语法与实际 VR 编码不符，已按实际编码处理并原样保持' })
  }
  const modality = decodeAscii(parsed.dataset.find((el) => el.tag === '00080060')?.value)
  file.dicom = {
    transferSyntax: TS_NAMES[parsed.transferSyntax] ?? parsed.transferSyntax,
    modality: modality || '—',
    hasPixelData: Boolean(parsed.pixel),
    ...result.stats,
  }

  // In-memory verification of the new header.
  const checks = []
  try {
    const charsetEl = result.dataset.find((el) => el.tag === '00080005')
    const charset = charsetDecoder(charsetEl ? decodeAscii(charsetEl.value) : '')
    const reparsed = parseDicomBuffer(header, { dict: dictVr })
    const newTs = decodeAscii(reparsed.meta.find((el) => el.tag === '00020010')?.value)
    checks.push({ name: '重新解析', ok: true, detail: '头部可正常解析' })
    checks.push({ name: '传输语法', ok: newTs === parsed.transferSyntax, detail: newTs === parsed.transferSyntax ? '未改变' : '发生变化' })
    checks.push(...verifyHeader(reparsed, result.originals, charset))
  } catch (error) {
    checks.push({ name: '重新解析', ok: false, detail: String(error?.message ?? error) })
  }

  {
    const target = resolve(outputDir, outputRelPath)
    if (!target.startsWith(resolve(outputDir) + sep)) {
      file.issues.push({ severity: 'error', code: 'write', detail: '输出路径越界' })
      return finish('failed')
    }
    const temp = `${target}.tmp-${process.pid}`
    try {
      if (guard) await guard.check(target)
      await mkdir(dirname(target), { recursive: true })
      const sourceHash = createHash('sha256')
      const pixel = parsed.pixel
      async function* body() {
        yield header
        if (pixel && pixel.end > pixel.start) {
          for await (const chunk of createReadStream(path, { start: pixel.start, end: pixel.end - 1 })) {
            sourceHash.update(chunk)
            yield chunk
          }
        }
        if (tail.length > 0) yield tail
      }
      await pipeline(body(), createWriteStream(temp, { mode: 0o600 }))
      if (pixel) {
        const written = await readDicom(temp, { dict: dictVr })
        const writtenHash = written.pixel ? await hashRange(temp, written.pixel.start, written.pixel.end) : ''
        const same = writtenHash === sourceHash.digest('hex')
          && written.pixel.end - written.pixel.start === pixel.end - pixel.start
        checks.push({ name: '像素数据', ok: same, detail: same ? '逐字节一致（SHA-256）' : '与原文件不一致' })
      } else {
        checks.push({ name: '像素数据', ok: true, detail: '文件不含像素数据' })
      }
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      file.issues.push({ severity: 'error', code: 'write', detail: String(error?.message ?? error) })
      file.structure = { ok: false, checks }
      return finish('failed')
    }
  }

  file.structure = { ok: checks.every((check) => check.ok), checks }
  for (const check of checks.filter((item) => !item.ok)) {
    file.issues.push({ severity: 'error', code: 'dicom-verify', detail: `${check.name}：${check.detail}` })
  }
  return finish(file.issues.some((issue) => issue.severity === 'error') ? 'review' : 'clean')
}

async function hashRange(path, start, end) {
  const hash = createHash('sha256')
  if (end > start) {
    for await (const chunk of createReadStream(path, { start, end: end - 1 })) hash.update(chunk)
  }
  return hash.digest('hex')
}
