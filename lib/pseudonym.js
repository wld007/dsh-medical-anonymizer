/**
 * Consistent pseudonym vault.
 *
 * Tokens are deterministic for one vault salt, so the same identifier maps to
 * the same token across rounds, files, and batches that share an output root.
 * The vault is the only place that holds original values.
 */
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync,
} from 'node:crypto'
import { readFile, writeFile, rename, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const LABELS = {
  '姓名': '化名',
  '医生': '医生',
  '身份证号': '证件',
  '电话': '电话',
  '邮箱': '邮箱',
  '地址': '地址',
  '病历号': '病历',
  '住院号': '住院',
  '就诊号': '就诊',
  '社保号': '社保',
  '银行卡号': '银行卡',
  '医院': '医院',
}

export function labelOf(type) {
  return LABELS[type] ?? '标识'
}

function normalize(value) {
  return String(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function keyOf(type, original) {
  return `${type}|${normalize(original)}`
}

export class Vault {
  /**
   * @param {string} file absolute path
   * @param {string} [passphrase] when set, the vault is AES-256-GCM encrypted
   */
  constructor(file, passphrase = '') {
    this.file = file
    this.passphrase = passphrase || ''
    this.salt = null
    this.entries = new Map()
    this.nextSeq = 1
    this.dirty = false
  }

  async load() {
    let raw
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.salt = randomBytes(16).toString('hex')
      this.dirty = true
      return this
    }
    const wrapper = JSON.parse(raw)
    let payload
    if (wrapper.enc === 'aes-256-gcm') {
      if (!this.passphrase) {
        throw new Error('映射库已加密，需要配置 vaultPassphrase 才能读取')
      }
      payload = decrypt(wrapper, this.passphrase)
    } else {
      payload = wrapper
    }
    this.salt = String(payload.salt)
    for (const entry of payload.entries ?? []) {
      this.entries.set(keyOf(entry.type, entry.original), entry)
    }
    this.nextSeq = Number(payload.nextSeq ?? this.entries.size + 1)
    return this
  }

  token(type, original) {
    const key = keyOf(type, original)
    const existing = this.entries.get(key)
    if (existing) return existing.pseudonym
    let code = this.codeFor(type, original)
    let pseudonym = `${labelOf(type)}-${code}`
    // Collision guard: extend the code rather than reuse another identity.
    let extra = 0
    while ([...this.entries.values()].some((entry) => entry.pseudonym === pseudonym)) {
      extra += 1
      code = this.codeFor(type, original, extra)
      pseudonym = `${labelOf(type)}-${code}`
    }
    this.entries.set(key, {
      type,
      original,
      pseudonym,
      seq: this.nextSeq++,
      firstSeen: new Date().toISOString(),
    })
    this.dirty = true
    return pseudonym
  }

  codeFor(type, original, extra = 0) {
    const digest = createHmac('sha256', this.salt)
      .update(`${type}\u0000${normalize(original)}\u0000${extra}`)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase()
    return digest
  }

  size() {
    return this.entries.size
  }

  async save() {
    if (!this.dirty) return
    await mkdir(dirname(this.file), { recursive: true })
    const payload = {
      version: 1,
      salt: this.salt,
      updatedAt: new Date().toISOString(),
      nextSeq: this.nextSeq,
      entries: [...this.entries.values()],
    }
    let body
    if (this.passphrase) {
      body = JSON.stringify(encrypt(payload, this.passphrase))
    } else {
      body = JSON.stringify(payload, null, 2)
    }
    const tmp = `${this.file}.tmp-${process.pid}`
    await writeFile(tmp, body, { mode: 0o600 })
    await rename(tmp, this.file)
    await chmod(this.file, 0o600)
    this.dirty = false
  }
}

function encrypt(payload, passphrase) {
  const salt = randomBytes(16)
  const key = scryptSync(passphrase, salt, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    version: 1,
    enc: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function decrypt(wrapper, passphrase) {
  const salt = Buffer.from(wrapper.salt, 'base64')
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(wrapper.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(wrapper.tag, 'base64'))
  const data = Buffer.concat([decipher.update(Buffer.from(wrapper.data, 'base64')), decipher.final()])
  return JSON.parse(data.toString('utf8'))
}
