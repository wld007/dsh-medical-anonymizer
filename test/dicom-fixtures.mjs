/**
 * Synthetic DICOM fixtures, built byte by byte without the plugin's codec so
 * that tests do not share its bugs. All values are invented.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const LONG = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT'])

function pad(buf, vr) {
  if (buf.length % 2 === 0) return buf
  return Buffer.concat([buf, Buffer.from([vr === 'UI' || vr === 'OB' ? 0 : 0x20])])
}

function val(v) {
  return Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'latin1')
}

/** el(tag, vr, value) — value: string | Buffer | Array<items> (SQ) */
export function el(tag, vr, value, opts = {}) {
  return { tag, vr, value, ...opts }
}

function tagBuf(tag) {
  const out = Buffer.alloc(4)
  out.writeUInt16LE(parseInt(tag.slice(0, 4), 16), 0)
  out.writeUInt16LE(parseInt(tag.slice(4), 16), 2)
  return out
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }

export function encode(elements, explicit) {
  return Buffer.concat(elements.map((e) => encodeOne(e, explicit)))
}

function encodeOne(e, explicit) {
  let body
  let undef = false
  if (e.vr === 'SQ') {
    const parts = []
    for (const item of e.value) {
      const content = encode(item, explicit)
      if (e.undefItems) parts.push(Buffer.from([0xFE, 0xFF, 0x00, 0xE0, 0xFF, 0xFF, 0xFF, 0xFF]), content, Buffer.from([0xFE, 0xFF, 0x0D, 0xE0, 0, 0, 0, 0]))
      else parts.push(Buffer.from([0xFE, 0xFF, 0x00, 0xE0]), u32(content.length), content)
    }
    if (e.undef) {
      parts.push(Buffer.from([0xFE, 0xFF, 0xDD, 0xE0, 0, 0, 0, 0]))
      undef = true
    }
    body = Buffer.concat(parts)
  } else if (e.fragments) {
    const parts = e.fragments.map((frag) => Buffer.concat([Buffer.from([0xFE, 0xFF, 0x00, 0xE0]), u32(frag.length), frag]))
    parts.push(Buffer.from([0xFE, 0xFF, 0xDD, 0xE0, 0, 0, 0, 0]))
    body = Buffer.concat(parts)
    undef = true
  } else {
    body = pad(val(e.value), e.vr)
  }
  const length = undef ? 0xFFFFFFFF : body.length
  if (!explicit) return Buffer.concat([tagBuf(e.tag), u32(length), body])
  if (LONG.has(e.vr)) return Buffer.concat([tagBuf(e.tag), Buffer.from(e.vr), Buffer.alloc(2), u32(length), body])
  return Buffer.concat([tagBuf(e.tag), Buffer.from(e.vr), u16(length), body])
}

export function part10({ sopClass, sopInstance, ts, dataset, explicit, tail = [] }) {
  const meta = encode([
    el('00020001', 'OB', Buffer.from([0, 1])),
    el('00020002', 'UI', sopClass),
    el('00020003', 'UI', sopInstance),
    el('00020010', 'UI', ts),
    el('00020012', 'UI', '1.2.826.0.1.3680043.9.9999'),
    el('00020016', 'AE', 'HOSPITAL_PACS'),
  ], true)
  const groupLength = encode([el('00020000', 'UL', u32(meta.length))], true)
  return Buffer.concat([
    Buffer.alloc(128), Buffer.from('DICM'), groupLength, meta,
    encode(dataset, explicit), encode(tail, explicit),
  ])
}

// GBK/GB18030 bytes, decoded and checked by the test.
export const GBK = {
  张三: Buffer.from([0xD5, 0xC5, 0xC8, 0xFD]),
  胸部平扫: Buffer.from([0xD0, 0xD8, 0xB2, 0xBF, 0xC6, 0xBD, 0xC9, 0xA8]),
}

export const CT = '1.2.840.10008.5.1.4.1.1.2'
export const STUDY = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.123456'
export const SERIES = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.123457'
export const SOP1 = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.200001'
export const SOP2 = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.200002'
export const SOP3 = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.200003'
export const SOP4 = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.200004'
export const FOR = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.300001'

export function pixelBytes(seed, length) {
  const out = Buffer.alloc(length)
  let x = seed
  for (let i = 0; i < length; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7FFFFFFF
    out[i] = x & 0xFF
  }
  return out
}

function patientA(extra = []) {
  return [
    el('00080005', 'CS', 'GB18030'),
    el('00080008', 'CS', 'ORIGINAL\\PRIMARY\\AXIAL'),
    el('00080016', 'UI', CT),
    el('00080020', 'DA', '20240301'),
    el('00080030', 'TM', '093000'),
    el('00080050', 'SH', 'ACC9988776'),
    el('00080060', 'CS', 'CT'),
    el('00080070', 'LO', 'ACME Medical'),
    el('00080080', 'LO', 'Beijing Example Hospital'),
    el('00080090', 'PN', 'LI^QIANG'),
    el('00081010', 'SH', 'CT_ROOM_3'),
    el('00081030', 'LO', GBK.胸部平扫),
    el('00100010', 'PN', Buffer.concat([Buffer.from('ZHANG^SAN='), GBK.张三])),
    el('00100020', 'LO', 'P0012345'),
    el('00100030', 'DA', '19790315'),
    el('00100040', 'CS', 'M'),
    el('00101010', 'AS', '045Y'),
    el('00101030', 'DS', '70'),
    el('00102154', 'SH', '13800138000'),
    el('00181000', 'LO', 'SN-77881'),
    el('00181030', 'LO', 'Chest Routine'),
    el('0020000D', 'UI', STUDY),
    el('0020000E', 'UI', SERIES),
    el('00200010', 'SH', 'S-2024-0001'),
    el('00200052', 'UI', FOR),
    ...extra,
  ]
}

const sortByTag = (list) => list.sort((a, b) => a.tag.localeCompare(b.tag))

/** Writes the fixture tree; returns paths and the raw pixel ranges. */
export async function writeDicomFixtures(dir) {
  await mkdir(join(dir, 'patientA', 'CT1'), { recursive: true })
  await mkdir(join(dir, 'patientB'), { recursive: true })
  const pixels = {}

  // 1. Explicit VR LE, private tags, nested sequences, cross-reference to SOP2.
  pixels.a1 = pixelBytes(1, 2048)
  const a1 = part10({
    sopClass: CT, sopInstance: SOP1, ts: '1.2.840.10008.1.2.1', explicit: true,
    dataset: sortByTag(patientA([
      el('00080018', 'UI', SOP1),
      el('0008103E', 'LO', 'Call 13800138000 for results'),
      el('00081140', 'SQ', [[
        el('00081150', 'UI', CT),
        el('00081155', 'UI', SOP2),
      ]]),
      el('00090010', 'LO', 'ACME_PRIVATE'),
      el('00091001', 'LO', 'ZHANG^SAN'),
      el('00101002', 'SQ', [[el('00100020', 'LO', 'OLD-ID-55667')]], { undef: true, undefItems: true }),
      el('7FE00010', 'OW', pixels.a1),
    ])),
  })
  await writeFile(join(dir, 'patientA', 'CT1', 'IM0001.dcm'), a1)

  // 2. Implicit VR LE, extensionless; an undocumented tag holding a UID.
  pixels.a2 = pixelBytes(2, 1024)
  const a2 = part10({
    sopClass: CT, sopInstance: SOP2, ts: '1.2.840.10008.1.2', explicit: false,
    dataset: sortByTag(patientA([
      el('00080018', 'UI', SOP2),
      el('0008103E', 'LO', 'Lung 1.25mm'),
      el('0020F00D', 'UN', SERIES), // not in any dictionary: UID heuristic
      el('00291010', 'OB', Buffer.from('PRIVATE-BLOB')),
      el('00400275', 'SQ', [[el('00401001', 'SH', 'REQ-123456')]], { undef: true }),
      el('7FE00010', 'OW', pixels.a2),
    ])),
  })
  await writeFile(join(dir, 'patientA', 'CT1', 'IM0002'), a2)

  // 3. Encapsulated (JPEG baseline) with trailing padding after the pixels.
  pixels.a3fragments = [Buffer.alloc(0), pixelBytes(3, 777), pixelBytes(4, 300)]
  const a3 = part10({
    sopClass: CT, sopInstance: SOP3, ts: '1.2.840.10008.1.2.4.50', explicit: true,
    dataset: sortByTag(patientA([
      el('00080018', 'UI', SOP3),
      el('7FE00010', 'OB', null, { fragments: pixels.a3fragments }),
    ])),
    tail: [el('FFFCFFFC', 'OB', Buffer.alloc(16))],
  })
  await writeFile(join(dir, 'patientA', 'CT1', '1.2.3.4.5'), a3)

  // 4. Another patient.
  pixels.b1 = pixelBytes(5, 512)
  const b1 = part10({
    sopClass: CT, sopInstance: SOP4, ts: '1.2.840.10008.1.2.1', explicit: true,
    dataset: sortByTag([
      el('00080005', 'CS', 'ISO_IR 192'),
      el('00080016', 'UI', CT),
      el('00080018', 'UI', SOP4),
      el('00080020', 'DA', '20240305'),
      el('00080060', 'CS', 'CT'),
      el('00100010', 'PN', Buffer.from('WANG^FANG=王芳', 'utf8')),
      el('00100020', 'LO', 'P0099999'),
      el('00100030', 'DA', '19500101'),
      el('00101010', 'AS', '093Y'),
      el('0020000D', 'UI', `${STUDY}.9`),
      el('0020000E', 'UI', `${SERIES}.9`),
      el('7FE00010', 'OW', pixels.b1),
    ]),
  })
  await writeFile(join(dir, 'patientB', 'b1.dcm'), b1)

  // 5. DICOMDIR: must be skipped, not copied.
  const dicomdir = part10({
    sopClass: '1.2.840.10008.1.3.10', sopInstance: '1.2.3.999', ts: '1.2.840.10008.1.2.1', explicit: true,
    dataset: [el('00041130', 'CS', 'EXAMPLE'), el('00100010', 'PN', 'ZHANG^SAN')],
  })
  await writeFile(join(dir, 'DICOMDIR'), dicomdir)

  // 6. Explicit VR big endian: refused.
  const bigEndian = part10({
    sopClass: CT, sopInstance: '1.2.3.998', ts: '1.2.840.10008.1.2.2', explicit: true,
    dataset: [],
  })
  await writeFile(join(dir, 'patientB', 'big.dcm'), bigEndian)

  return { pixels }
}
